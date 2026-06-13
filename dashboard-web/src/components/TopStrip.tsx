'use client';

import { Menu, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { CommandPalette } from './CommandPalette';
import { FreshnessChip } from './FreshnessChip';
import { SyncIndicator } from './SyncIndicator';
import type { DashboardData, Filters as F } from '@/lib/types';
import type { TabKey } from '@/lib/urlState';

/**
 * Hebrew page label per tab — drives the TopStrip breadcrumb + title.
 *
 * Mirrors the labels in Sidebar.tsx's `NAV` array verbatim (same source of
 * truth for the human-facing tab name); kept local so TopStrip doesn't import
 * the Sidebar's whole nav config just for the strings.
 *
 * TODO(reskin): dedupe tab labels with Sidebar NAV — both this map and the
 * Sidebar `NAV` array (and CommandPalette's `tabs` list) hand-maintain the
 * same TabKey → Hebrew-label mapping. Extract a single `TAB_LABELS` constant
 * in `@/lib/urlState` (next to the `TabKey` union) and have all three consume
 * it so a new tab can't drift its label across surfaces.
 */
const TAB_LABELS: Record<TabKey, string> = {
  home: 'בית',
  activity: 'פעילות',
  customers: 'לקוחות',
  archive: 'טבלאות אופטימיזציה',
  pnl: 'P&L',
  trends: 'מגמות',
  campaigns: 'קמפיינים',
  products: 'מוצרים',
  payments: 'תשלומים',
  detail: 'פירוט',
};

type Props = {
  activeTab: TabKey;
  /**
   * Current dashboard payload, or null while the first fetch is in flight.
   * The strip ALWAYS renders (chrome must be usable during loading); the
   * CommandPalette accepts a nullable `data` so nav/preset/theme commands work
   * immediately and the store list simply populates once data arrives.
   */
  data: DashboardData | null;
  filters: F;
  setFilters: (next: F) => void;
  setActiveTab: (next: TabKey) => void;
  onRefresh: () => void;
  onOpenAiReport: () => void;
  onOpenMobileSidebar: () => void;
  /** Last cron write timestamp for the freshness chip. */
  dataLastWriteAt: string | null;
};

/**
 * Horizon floating navbar — extracted from the old inline Dashboard `<header>`
 * and re-skinned to the approved mockup (home-approved.html lines 84–97).
 *
 * NON-STICKY (operator-locked): unlike the prior `sticky top-0 z-30` banner,
 * this floats in normal flow with a `mt-4` lift + a rounded-full frosted bar.
 * The frosted surface is `color-mix(in_oklab, var(--glass-1) 80%, transparent)`
 * — the --glass-1 token resolves to the white card surface in light and the
 * navy-800 card surface in dark, so the 80% mix reproduces the mockup's
 * white-at-80%/navy-800-at-80% navbar exactly in both themes (re-skins with the
 * token, never a hardcoded colour).
 *
 * No information is lost vs the old header: the mobile hamburger, FreshnessChip,
 * CommandPalette, and SyncIndicator all survive. NEW from the mockup: a
 * breadcrumb ("עמודים / <page>") + a big page-title line + the AI-export button
 * (the brand `<Button>` primitive, wired to onOpenAiReport).
 */
export function TopStrip({
  activeTab,
  data,
  filters,
  setFilters,
  setActiveTab,
  onRefresh,
  onOpenAiReport,
  onOpenMobileSidebar,
  dataLastWriteAt,
}: Props) {
  const pageLabel = TAB_LABELS[activeTab] ?? TAB_LABELS.home;

  return (
    <div
      role="banner"
      data-testid="top-strip"
      className={cn(
        // Horizon floating navbar — NOT sticky. `mt-4` float + rounded-full
        // frosted bar + Horizon's signature card shadow (light only; dark is
        // shadowless per the recipe). Frostiness via color-mix on --glass-1
        // (white / navy-800) so it re-skins per token in both themes.
        'mt-4 flex items-center gap-2 sm:gap-3 rounded-pill',
        'bg-[color-mix(in_oklab,var(--glass-1)_80%,transparent)] backdrop-blur-xl',
        'border border-glass-edge shadow-soft',
        'px-3 sm:px-5 py-2',
      )}
    >
      {/* Mobile-only hamburger — opens the off-canvas Sidebar drawer. The only
          mobile sidebar opener; hidden from md+ (the rail is persistent there).
          Sits on the start side (right in RTL) so it's reachable by thumb. */}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={onOpenMobileSidebar}
        className="md:hidden shrink-0"
        aria-label="פתח תפריט"
      >
        <Menu size={20} />
      </Button>

      {/* Breadcrumb + page title (mockup recipe). Derived from activeTab. */}
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-secondary truncate">
          עמודים / <b className="font-bold text-ink">{pageLabel}</b>
        </div>
        <div className="text-xl font-black text-ink -mt-0.5 truncate">
          {pageLabel}
        </div>
      </div>

      {/* Spacer pushes the controls to the opposite end. */}
      <div className="flex-1" />

      {/* Right cluster — CommandPalette trigger, FreshnessChip, SyncIndicator,
          AI-export. The palette ALWAYS mounts (even while data is null) so the
          ⌘K trigger + nav/preset/theme commands are usable during loading. */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <CommandPalette
          data={data}
          filters={filters}
          setFilters={setFilters}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onRefresh={onRefresh}
          onOpenAiReport={onOpenAiReport}
        />
        <FreshnessChip dataLastWriteAt={dataLastWriteAt} />
        <SyncIndicator />
        {/* AI-export — the brand `<Button>` primitive (NOT raw bg-brand/text-
            white). Mirrors AiReportButton's own trigger (Bot icon + copy); the
            real export modal is owned by AiReportButton (mounted modal-only on
            the home tab) and opened via the signal this handler bumps.

            RESPONSIVE (reskin-w8): the action is reachable at ALL widths. On
            phones (<md) it renders ICON-ONLY (the Bot glyph) so it doesn't
            crowd the 375px floating bar — the text label collapses via
            `hidden md:inline` while the Bot icon always shows. A constant
            `aria-label` gives the icon-only mobile presentation an accessible
            name (the visible text is display:none there). From md+ the full
            labeled pill appears, matching the approved mockup. The palette
            command ("ייצא דוח ל-AI", ⌘K) remains a second affordance.

            HOME-ONLY: the report modal listener (AiReportButton) lives only on
            the home tab, so on every other tab this button would be a no-op /
            confusing dead control. The approved mockup (home-approved.html:96)
            is the HOME navbar, and only home has an approved navbar mockup —
            so the navbar export button is home-scoped here. ⌘K → "ייצא דוח
            ל-AI" is likewise wired to the same signal and is meaningful on the
            home tab. */}
        {activeTab === 'home' && (
          <Button
            type="button"
            size="sm"
            onClick={onOpenAiReport}
            data-testid="top-strip-ai-export"
            aria-label="ייצא דוח ל-AI"
            className="inline-flex shrink-0 rounded-pill font-bold gap-1.5 px-2.5 md:px-3"
          >
            <Bot size={15} className="shrink-0" />
            <span className="hidden md:inline">ייצא דוח ל-AI</span>
          </Button>
        )}
      </div>
    </div>
  );
}
