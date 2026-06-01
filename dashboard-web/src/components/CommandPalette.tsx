'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import useSWR from 'swr';
import {
  Search,
  CalendarDays,
  Store as StoreIcon,
  Home,
  TrendingUp,
  Megaphone,
  Package,
  Table,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Bot,
  Command as CmdIcon,
  Receipt,
  X,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useDrawerEsc } from '@/lib/drawerStack';
import type { DashboardData, Filters as F, PresetKey } from '@/lib/types';
import { PRESET_LABELS, computePresetRange } from '@/lib/presets';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { ProductsResponse } from '@/app/api/products/route';

/**
 * Cmd-K command palette — Linear / Notion / Superhuman pattern.
 *
 * Hebrew-aware: type "uzo" → match uzoshop. Type "אתמול" → match the
 * "yesterday" preset. Type a campaign name → jump to the campaign.
 *
 * Categories:
 *   - Navigation (home / analysis / campaigns / products / detail)
 *   - Time ranges (presets)
 *   - Stores
 *   - Live shortcuts (today, this week, this month)
 *   - Campaigns (top 20 by spend in the current period)
 *   - Products (top 20 by units in the current period)
 *   - Actions (refresh data, AI report, etc.)
 *
 * Keyboard: ↑/↓ to navigate, Enter to act, Esc to dismiss, ⌘K / Ctrl-K
 * to open. The trigger pill in the header is also clickable for non-power
 * users / touch users.
 */

type TabKey = 'home' | 'pnl' | 'analysis' | 'campaigns' | 'products' | 'detail';

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null));

type CommandKind = 'tab' | 'preset' | 'store' | 'campaign' | 'product' | 'action';

type Command = {
  id: string;
  kind: CommandKind;
  /** Display label. Strings are rendered as-is; ReactNode lets call sites
   * wrap dynamic LTR fragments (campaign / product names) in <bdi> to
   * isolate them from the surrounding Hebrew RTL flow. */
  label: React.ReactNode;
  /** Plain-text version of the label, used for sort/match scoring (label
   * may be a ReactNode that contains <bdi> wrappers we don't want to
   * include in the search corpus). */
  labelText: string;
  subtitle?: React.ReactNode;
  icon: React.ReactNode;
  /** A search corpus joined into a single lower-case string. */
  search: string;
  perform: () => void;
};

type Props = {
  data: DashboardData;
  filters: F;
  setFilters: (next: F) => void;
  activeTab: TabKey;
  setActiveTab: (next: TabKey) => void;
  onRefresh: () => void;
  onOpenAiReport: () => void;
};

export function CommandPalette({
  data,
  filters,
  setFilters,
  activeTab: _activeTab,
  setActiveTab,
  onRefresh,
  onOpenAiReport,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { setChoice: setThemeChoice } = useTheme();

  // Fetch enriched data lazily (only after the palette has been opened once).
  const [warmCache, setWarmCache] = useState(false);
  const { data: products } = useSWR<ProductsResponse | null>(
    warmCache ? '/api/products' : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: campaigns } = useSWR<CampaignsResponse | null>(
    warmCache ? '/api/campaigns' : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  // Open / close handlers
  //
  // ESC is delegated to the shared drawer stack (`useDrawerEsc` below) so the
  // palette cooperates with any open drilldown drawer — only the topmost
  // listener fires, preventing the whole stack from collapsing on one
  // keystroke. This local handler keeps ONLY the global Cmd+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Audit fix 2026-05-23 (d/HI-10): don't hijack Cmd+K when the user
        // is typing inside an input, textarea, or contenteditable element.
        // The previous handler intercepted Cmd+K everywhere — operator
        // hitting Cmd+K while editing the campaign-mapping search box,
        // the AI-report textarea, or any /operator form would lose their
        // current text and have the palette modal flash over the page.
        const t = e.target as HTMLElement | null;
        const isEditable =
          !!t && (
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
          );
        if (isEditable) return;
        e.preventDefault();
        setOpen(o => !o);
        setWarmCache(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // a11y + drawer-stack coordination: route ESC through the shared stack so
  // closing the palette never collapses an open drilldown below it.
  useDrawerEsc(open, () => setOpen(false));

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Autofocus on next tick so the dialog has mounted.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // ---- Build the command list -----------------------------------------------
  const allCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [];

    // Navigation
    const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; search: string }> = [
      { key: 'home',      label: 'מעבר ל-בית',     icon: <Home size={15} />,        search: 'בית home overview ראשי' },
      { key: 'pnl',       label: 'מעבר ל-P&L',     icon: <Receipt size={15} />,     search: 'pnl רווח הוצאות profit loss' },
      { key: 'analysis',  label: 'מעבר ל-ניתוח',    icon: <TrendingUp size={15} />,  search: 'ניתוח analysis trends גרף' },
      { key: 'campaigns', label: 'מעבר ל-קמפיינים', icon: <Megaphone size={15} />,    search: 'קמפיינים campaigns ads מודעות' },
      { key: 'products',  label: 'מעבר ל-מוצרים',   icon: <Package size={15} />,     search: 'מוצרים products items' },
      { key: 'detail',    label: 'מעבר ל-פירוט',    icon: <Table size={15} />,       search: 'פירוט detail rows daily' },
    ];
    for (const t of tabs) {
      cmds.push({
        id: `tab-${t.key}`,
        kind: 'tab',
        label: t.label,
        labelText: t.label,
        icon: t.icon,
        search: t.search.toLowerCase(),
        perform: () => { setActiveTab(t.key); close(); },
      });
    }

    // Time presets
    (Object.keys(PRESET_LABELS) as PresetKey[]).forEach(p => {
      if (p === 'custom') return;
      cmds.push({
        id: `preset-${p}`,
        kind: 'preset',
        label: PRESET_LABELS[p],
        labelText: PRESET_LABELS[p],
        subtitle: 'טווח זמן',
        icon: <CalendarDays size={15} />,
        search: `${PRESET_LABELS[p]} ${p} time range תקופה`.toLowerCase(),
        perform: () => {
          setFilters({ ...filters, preset: p, range: computePresetRange(p) });
          close();
        },
      });
    });

    // Stores
    cmds.push({
      id: 'store-all',
      kind: 'store',
      label: 'כל החנויות',
      labelText: 'כל החנויות',
      subtitle: 'בחירת חנות',
      icon: <StoreIcon size={15} />,
      search: 'כל החנויות all stores'.toLowerCase(),
      perform: () => { setFilters({ ...filters, store: 'All' }); close(); },
    });
    for (const s of data.stores) {
      cmds.push({
        id: `store-${s}`,
        kind: 'store',
        // Store IDs are English/LTR; wrap in <bdi> so they always render as
        // an atomic LTR run inside the Hebrew RTL palette body.
        label: <bdi dir="ltr">{s}</bdi>,
        labelText: s,
        subtitle: 'בחירת חנות',
        icon: <StoreIcon size={15} />,
        search: `${s} store חנות`.toLowerCase(),
        perform: () => { setFilters({ ...filters, store: s }); close(); },
      });
    }

    // Top campaigns by spend in last 30 days (cap to 30 results).
    if (campaigns?.rows) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const cutoff = (() => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();
      const agg = new Map<string, {
        campaignId: string;
        campaignName: string;
        store: string;
        platform: string;
        spend: number;
        value: number;
      }>();
      for (const r of campaigns.rows) {
        if (r.date < cutoff) continue;
        const k = `${r.storeId}::${r.platform}::${r.campaignId}`;
        if (!agg.has(k)) {
          agg.set(k, {
            campaignId: r.campaignId,
            campaignName: r.campaignName,
            store: r.storeName,
            platform: r.platform,
            spend: 0,
            value: 0,
          });
        }
        const e = agg.get(k)!;
        e.spend += r.spend;
        e.value += r.conversionValue;
      }
      const top = Array.from(agg.values())
        .filter(c => c.spend > 0)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 30);
      for (const c of top) {
        const roas = c.spend > 0 ? c.value / c.spend : 0;
        const campaignNameText = c.campaignName || '(ללא שם)';
        cmds.push({
          id: `campaign-${c.campaignId}`,
          kind: 'campaign',
          // Wave 4 / Task 4.2 — campaign name is LTR English (sometimes
          // mixed with digits); isolate it in <bdi> so RTL flow can't
          // shuffle its components.
          label: <bdi dir="ltr">{campaignNameText}</bdi>,
          labelText: campaignNameText,
          // Subtitle interpolates platform name (LTR), store id (LTR), and
          // a ROAS number into a Hebrew RTL row. Each LTR atom gets its
          // own <bdi> wrap so the order stays Platform · Store · ROAS …
          // regardless of bidi heuristics.
          subtitle: (
            <>
              <bdi dir="ltr">{c.platform}</bdi>
              {' · '}
              <bdi dir="ltr">{c.store}</bdi>
              {' · ROAS '}
              <bdi dir="ltr">{roas.toFixed(2)}</bdi>
            </>
          ),
          icon: <Megaphone size={15} />,
          search: `${c.campaignName} ${c.platform} ${c.store} קמפיין`.toLowerCase(),
          perform: () => {
            setFilters({ ...filters, store: c.store });
            setActiveTab('campaigns');
            close();
          },
        });
      }
    }

    // Top products by units in last 30 days (cap to 30).
    if (products?.rows) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const cutoff = (() => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();
      const agg = new Map<string, {
        title: string;
        store: string;
        units: number;
        revenue: number;
      }>();
      for (const r of products.rows) {
        if (r.date < cutoff) continue;
        const k = `${r.storeName}::${r.productId || r.productTitle}`;
        if (!agg.has(k)) {
          agg.set(k, { title: r.productTitle, store: r.storeName, units: 0, revenue: 0 });
        }
        const e = agg.get(k)!;
        e.units += r.units;
        e.revenue += r.revenue;
      }
      const top = Array.from(agg.values())
        .filter(p => p.units > 0)
        .sort((a, b) => b.units - a.units)
        .slice(0, 30);
      for (const p of top) {
        cmds.push({
          id: `product-${p.store}::${p.title}`,
          kind: 'product',
          // Product title is typically LTR English; wrap in <bdi>.
          label: <bdi dir="ltr">{p.title}</bdi>,
          labelText: p.title,
          // Subtitle mixes English store id + Hebrew "יחידות" + a localised
          // number. The LTR atoms each get their own <bdi> so the visual
          // order stays "<store> · <units> יחידות" rather than collapsing
          // through bidi reordering.
          subtitle: (
            <>
              <bdi dir="ltr">{p.store}</bdi>
              {' · '}
              <bdi dir="ltr">{p.units.toLocaleString('he-IL')}</bdi>
              {' יחידות'}
            </>
          ),
          icon: <Package size={15} />,
          search: `${p.title} ${p.store} מוצר`.toLowerCase(),
          perform: () => {
            setFilters({ ...filters, store: p.store });
            setActiveTab('products');
            close();
          },
        });
      }
    }

    // Actions
    cmds.push({
      id: 'action-refresh',
      kind: 'action',
      label: 'רענן נתונים',
      labelText: 'רענן נתונים',
      subtitle: 'משוך מחדש מ-Sheets',
      icon: <RefreshCw size={15} />,
      search: 'רענן refresh reload עדכן'.toLowerCase(),
      perform: () => { onRefresh(); close(); },
    });
    cmds.push({
      id: 'action-ai-report',
      kind: 'action',
      label: 'ייצא דוח לבינה מלאכותית',
      labelText: 'ייצא דוח לבינה מלאכותית',
      subtitle: 'דוח Markdown מוכן ל-ChatGPT / Claude',
      icon: <Bot size={15} />,
      search: 'ai report ייצא chatgpt claude מארקדאון'.toLowerCase(),
      perform: () => { onOpenAiReport(); close(); },
    });
    cmds.push({
      id: 'action-meta',
      kind: 'action',
      label: 'פתח Meta Ads Manager',
      labelText: 'פתח Meta Ads Manager',
      subtitle: 'business.facebook.com',
      icon: <ExternalLink size={15} />,
      search: 'meta facebook ads manager פייסבוק'.toLowerCase(),
      perform: () => {
        window.open('https://business.facebook.com/adsmanager/', '_blank');
        close();
      },
    });
    cmds.push({
      id: 'action-google',
      kind: 'action',
      label: 'פתח Google Ads',
      labelText: 'פתח Google Ads',
      subtitle: 'ads.google.com',
      icon: <ExternalLink size={15} />,
      search: 'google ads גוגל'.toLowerCase(),
      perform: () => {
        window.open('https://ads.google.com/aw/overview', '_blank');
        close();
      },
    });

    // Theme toggles
    cmds.push({
      id: 'theme-light',
      kind: 'action',
      label: 'מעבר למצב בהיר',
      labelText: 'מעבר למצב בהיר',
      subtitle: 'Light theme',
      icon: <Sun size={14} />,
      search: 'theme light בהיר אור day',
      perform: () => setThemeChoice('light'),
    });
    cmds.push({
      id: 'theme-dark',
      kind: 'action',
      label: 'מעבר למצב כהה',
      labelText: 'מעבר למצב כהה',
      subtitle: 'Dark theme',
      icon: <Moon size={14} />,
      search: 'theme dark כהה לילה night',
      perform: () => setThemeChoice('dark'),
    });
    cmds.push({
      id: 'theme-system',
      kind: 'action',
      label: 'עקוב אחר העדפת המערכת',
      labelText: 'עקוב אחר העדפת המערכת',
      subtitle: 'Follow system',
      icon: <Monitor size={14} />,
      search: 'theme system auto אוטומטי מערכת',
      perform: () => setThemeChoice('system'),
    });

    return cmds;
  }, [data, filters, setFilters, setActiveTab, products, campaigns, onRefresh, onOpenAiReport, close, setThemeChoice]);

  // ---- Filtering -----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show a useful default set: tabs + presets + stores + first 6 actions.
      return allCommands.filter(c =>
        c.kind === 'tab' || c.kind === 'preset' || c.kind === 'store' || c.kind === 'action',
      );
    }
    // Score each command: starts-with > word-boundary > substring.
    const tokens = q.split(/\s+/).filter(Boolean);
    return allCommands
      .map(c => {
        let score = 0;
        for (const t of tokens) {
          // Use the plain-text companion (`labelText`) instead of `label`,
          // which may now be a ReactNode (Wave 4 / Task 4.2 — labels can
          // be <bdi>-wrapped React fragments for bidi isolation).
          if (c.labelText.toLowerCase().startsWith(t)) score += 100;
          else if (c.search.includes(' ' + t)) score += 50;
          else if (c.search.includes(t)) score += 25;
          else { score = -Infinity; break; }
        }
        return { c, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.c)
      .slice(0, 40);
  }, [allCommands, query]);

  // Re-clamp active index when filtered list changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keyboard navigation inside the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        filtered[activeIdx]?.perform();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIdx]);

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open, filtered.length]);

  // Group commands by kind for sectioned display.
  const grouped = useMemo(() => {
    const buckets: Record<CommandKind, Command[]> = {
      tab: [], preset: [], store: [], campaign: [], product: [], action: [],
    };
    for (const c of filtered) buckets[c.kind].push(c);
    return buckets;
  }, [filtered]);

  // Map filtered index back to a (group, position) so highlight works.
  const indexedFlat = filtered;

  // ---- Trigger pill + modal -----------------------------------------------
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => { setOpen(true); setWarmCache(true); }}
        className={cn(
          'gap-1.5 sm:gap-2 rounded-lg',
          'bg-glass-2 hover:bg-glass-3 active:bg-[color:var(--surface-elevated-1)]',
          'border border-glass-edge text-ink-secondary',
          'px-2.5 sm:px-3 py-1.5 sm:py-2 h-auto text-xs sm:text-sm font-medium shrink-0',
        )}
        title="חיפוש מהיר (⌘K)"
        aria-label="פתח פנל פקודות"
      >
        <Search size={14} />
        <span className="hidden sm:inline">חיפוש</span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] font-mono bg-glass-2 rounded border border-glass-edge tabular-nums">
          <CmdIcon size={9} />K
        </kbd>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] sm:pt-[12vh] px-3 bg-scrim backdrop-blur-md animate-fade-in"
          onClick={close}
        >
          <Card
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="Command Palette"
            // Sheet-class surface (deeper shadow than the default --shadow-glass)
            // so the palette reads as a modal-tier overlay rather than a card.
            // !shadow-sheet overrides Card's inherited --shadow-glass; the rest
            // (glass background, --glass-edge rim) stays from the primitive.
            className="w-full max-w-xl !p-0 !shadow-sheet overflow-hidden animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-glass-edge">
              <Search size={16} className="text-ink-muted shrink-0" />
              <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="חפש קמפיין, מוצר, חנות, פקודה…"
                className="flex-1 h-auto bg-transparent border-0 px-0 py-0 focus-visible:ring-0"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={close}
                aria-label="סגור"
              >
                <X size={14} />
              </Button>
            </div>

            {/* NL query placeholder slot (wired in Plan 2) */}
            {query.length > 0 && (
              <div className="px-3 py-2 border-b border-glass-edge text-xs text-ink-muted">
                <Sparkles size={12} className="inline-block me-1" />
                שאלת AI: <span className="text-ink">{query}</span>
                <span className="opacity-50">{' '}— יזמין ב-Plan 2</span>
              </div>
            )}

            {/* Results */}
            <div
              ref={listRef}
              className="max-h-[55vh] sm:max-h-[60vh] overflow-y-auto py-1"
            >
              {indexedFlat.length === 0 && (
                <div className="p-8 text-center text-sm text-ink-muted">
                  אין תוצאות עבור &quot;{query}&quot;
                </div>
              )}

              {indexedFlat.length > 0 && (
                <>
                  <GroupedSection
                    title="ניווט"
                    items={grouped.tab}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                  <GroupedSection
                    title="טווח זמן"
                    items={grouped.preset}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                  <GroupedSection
                    title="חנות"
                    items={grouped.store}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                  <GroupedSection
                    title="קמפיינים (30 ימים אחרונים)"
                    items={grouped.campaign}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                  <GroupedSection
                    title="מוצרים (30 ימים אחרונים)"
                    items={grouped.product}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                  <GroupedSection
                    title="פעולות"
                    items={grouped.action}
                    flat={indexedFlat}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                  />
                </>
              )}
            </div>

            {/* Footer hints */}
            <div className="px-4 py-2 border-t border-glass-edge flex items-center justify-between text-[10px] text-ink-muted">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-glass-2 rounded text-[9px] font-mono">↑↓</kbd>
                  ניווט
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-glass-2 rounded text-[9px] font-mono">↵</kbd>
                  בחר
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-glass-2 rounded text-[9px] font-mono">esc</kbd>
                  סגור
                </span>
              </div>
              <span className="inline-flex items-center gap-1">
                <Sparkles size={10} className="text-status-warningFg" />
                {indexedFlat.length} תוצאות
              </span>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function GroupedSection({
  title,
  items,
  flat,
  activeIdx,
  setActiveIdx,
}: {
  title: string;
  items: Command[];
  flat: Command[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="px-1 pb-1">
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
        {title}
      </div>
      <div>
        {items.map(item => {
          const globalIdx = flat.indexOf(item);
          const isActive = globalIdx === activeIdx;
          return (
            <Button
              key={item.id}
              variant="ghost"
              data-idx={globalIdx}
              onMouseMove={() => setActiveIdx(globalIdx)}
              onClick={() => item.perform()}
              className={cn(
                'w-full justify-start gap-3 px-3 py-2 h-auto rounded-lg mx-1',
                isActive
                  ? 'bg-accent-bg text-ink'
                  : 'text-ink-secondary hover:bg-glass-2',
              )}
            >
              <span
                className={cn(
                  'inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0',
                  isActive ? 'bg-accent-soft text-accent' : 'bg-glass-2 text-ink-muted',
                )}
              >
                {item.icon}
              </span>
              <div className="min-w-0 flex-1 text-start">
                <div className={cn(
                  'text-sm truncate',
                  isActive ? 'font-semibold text-ink' : 'font-medium',
                )}>
                  {item.label}
                </div>
                {item.subtitle && (
                  <div className="text-[10px] text-ink-muted truncate mt-0.5">
                    {item.subtitle}
                  </div>
                )}
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
