'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Home, Zap, Users, Receipt, TrendingUp, Megaphone, Package, Table, LayoutGrid,
  CreditCard, Cog, Sun, Moon, Monitor, Pin, PinOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/Button';
import { LogoutButton } from '@/components/LogoutButton';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/Sheet';
import { useSidebarPin } from '@/lib/hooks/useSidebarPin';
import { useDrawerEsc } from '@/lib/drawerStack';
import type { TabKey } from '@/lib/urlState';

type NavItem = {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  /** 1-based slot used in the ⌘N tooltip hint on collapsed state. */
  slot: number;
};

const NAV: NavItem[] = [
  { key: 'home',      label: 'בית',                icon: <Home size={16} />,        slot: 1 },
  // 'פעילות' (Activity) — the real-time store-events feed's "see all" surface.
  // Placed RIGHT AFTER 'בית' so the live-activity browse view is the first
  // follow-up to the at-a-glance home snapshot.
  { key: 'activity',  label: 'פעילות',             icon: <Zap size={16} />,         slot: 2 },
  // 'לקוחות' (Customer Value) — Wave 2 cohorts/LTV tab. Sits at slot 3, right
  // after 'פעילות', so the "how much is a customer worth?" view follows the
  // live-activity browse; the optimization tables + P&L deep-dives shift down.
  { key: 'customers', label: 'לקוחות',             icon: <Users size={16} />,       slot: 3 },
  { key: 'archive',   label: 'טבלאות אופטימיזציה',  icon: <LayoutGrid size={16} />,  slot: 4 },
  { key: 'pnl',       label: 'P&L',                icon: <Receipt size={16} />,     slot: 5 },
  { key: 'trends',    label: 'מגמות',              icon: <TrendingUp size={16} />,  slot: 6 },
  { key: 'campaigns', label: 'קמפיינים',           icon: <Megaphone size={16} />,   slot: 7 },
  { key: 'products',  label: 'מוצרים',             icon: <Package size={16} />,      slot: 8 },
  // 'תשלומים' (Payments) — per-month split of sales by payment gateway
  // (credit / PayPal / other). Sits right AFTER 'מוצרים' (its own room to grow,
  // e.g. real per-gateway processing fees later); 'פירוט' shifts down a slot.
  { key: 'payments',  label: 'תשלומים',            icon: <CreditCard size={16} />,  slot: 9 },
  { key: 'detail',    label: 'פירוט',              icon: <Table size={16} />,       slot: 10 },
];

/**
 * Wraps a single rail item in a collapsed-state tooltip showing the label
 * + a ⌘N shortcut hint. Expanded sidebars don't need the tooltip because
 * the label is already visible inline, so we pass `content={null}` and let
 * HelpTooltip short-circuit to a passthrough render.
 *
 * The shortcut text is wrapped in <bdi dir="ltr"> so the ⌘ glyph and digit
 * render left-to-right even inside the RTL body — otherwise "⌘1" would
 * mirror to "1⌘" which looks broken to keyboard-savvy users.
 */
function RailTooltip({
  show,
  label,
  shortcut,
  children,
}: {
  show: boolean;
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  const content = show ? (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {shortcut && (
        <bdi dir="ltr" className="font-mono text-2xs text-ink-muted">
          {shortcut}
        </bdi>
      )}
    </span>
  ) : null;
  return (
    // variant="text": the content is a non-string ReactNode (label + ⌘N
    // shortcut span), but this is a slim collapsed-rail label, NOT rich help —
    // pin it to a Radix Tooltip so the `auto` selector doesn't surface a
    // surprise Popover dialog on icon-hover (tooltip-system-redesign Task 1.4).
    <HelpTooltip content={content} variant="text" side="left" sideOffset={10}>
      {children}
    </HelpTooltip>
  );
}

/**
 * Renders the full nav body (brand + tabs + footer controls). Shared between
 * the desktop right-rail (`md:` and up) and the mobile off-canvas drawer
 * (below `md:`). The `collapsed` mode only applies on desktop — on mobile
 * the drawer is always rendered expanded for full readability.
 */
function SidebarBody({
  activeTab,
  onTabChange,
  collapsed,
  pinned,
  onTogglePin,
  onItemClick,
  variant,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
  /** True when rendering as a 72px icon-rail (desktop only). */
  collapsed: boolean;
  /** Sticky pin preference (desktop only). Drives the pin/unpin button glyph. */
  pinned: boolean;
  /** Flip the pinned preference (desktop only). */
  onTogglePin: () => void;
  /** Called after a nav item or operator link is tapped (used by mobile to close drawer). */
  onItemClick?: () => void;
  /** 'desktop' = honours collapsed; 'mobile' = always expanded, no collapse toggle. */
  variant: 'desktop' | 'mobile';
}) {
  const { choice, setChoice } = useTheme();
  const isCollapsed = variant === 'desktop' && collapsed;
  const showTooltips = isCollapsed;
  // Horizon rail is a SOLID surface — white in light, navy-800 in dark — in
  // BOTH the desktop rail and the mobile drawer (both paint --sidebar). Inner
  // items render through the sidebar fg tokens (dark-navy ink on white / light
  // ink on navy) so they always clear AA against the rail surface in either
  // theme.
  // Default (resting) text colour for an inner item.
  const railText = 'text-[var(--sidebar-fg)]';
  // Hover treatment — brighten text to the active fg + a faint tonal fill that
  // works on both the white (light) and navy-800 (dark) rail.
  const railHover =
    'hover:text-[var(--sidebar-fg-active)] hover:bg-[color-mix(in_oklab,var(--sidebar-fg)_8%,transparent)]';
  // Active / selected treatment — bolder active fg + a faint accent wash.
  // The active branch MUST declare its own hover:bg/hover:text: the ghost
  // Button variant ships `hover:bg-glass-2`, and on the active item (which
  // doesn't get railHover) that hover fill would otherwise win — on the white
  // light rail --glass-2 is near-white and would swallow the active ink.
  // Declaring an accent-based hover:bg here lets tailwind-merge drop the
  // ghost's glass-2 hover and keeps the active treatment intact.
  const railActive =
    'bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-[var(--sidebar-fg-active)] hover:bg-[color-mix(in_oklab,var(--accent)_30%,transparent)] hover:text-[var(--sidebar-fg-active)]';

  return (
    <>
      {/* Brand block — wordmark + store list (mockup recipe). */}
      <div
        className={cn(
          'border-b border-[color-mix(in_oklab,var(--sidebar-fg)_12%,transparent)]',
          isCollapsed ? 'px-3 py-4' : 'px-5 py-5',
        )}
      >
        <div className={cn('flex items-center gap-2', isCollapsed && 'justify-center')}>
          {/* Brand mark — "Insight Owl" (the sharp-eyed watcher of your ad
              spend; two eyes = two dashboards). Static SVG so the FIXED brand
              violet/orange never trips the token-only designColorGuard, and the
              SAME file backs the favicon (src/app/icon.svg). Fixed in both
              themes, like the prior violet tile it replaces. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/owl-mark.svg"
            alt=""
            aria-hidden
            width={28}
            height={28}
            className="h-7 w-7 rounded-md shrink-0"
          />
          {!isCollapsed && (
            <span className="text-base font-black tracking-tight truncate text-[var(--sidebar-fg-active)]">
              Insight <span className="font-medium">Owl</span>
            </span>
          )}
        </div>
        {!isCollapsed && (
          <div className="mt-1.5 text-[11px] font-medium truncate text-[var(--sidebar-fg)]">
            uzoshop · zolplus · usmile
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto" role="tablist">
        {NAV.map(item => {
          const isActive = item.key === activeTab;
          const button = (
            <Button
              key={item.key}
              // W8-T5 — tab↔panel ARIA wiring. Each tab gets a stable id
              // (`tab-${key}`) and points at the single main content panel via
              // `aria-controls`; the Dashboard <main> reciprocates with
              // role="tabpanel" + aria-labelledby={`tab-${activeTab}`}.
              id={`tab-${item.key}`}
              role="tab"
              type="button"
              variant="ghost"
              aria-controls="dashboard-tabpanel"
              aria-current={isActive ? 'page' : undefined}
              aria-selected={isActive}
              aria-label={isCollapsed ? item.label : undefined}
              onClick={() => {
                onTabChange(item.key);
                onItemClick?.();
              }}
              className={cn(
                // `relative` anchors the brand-500 vertical active indicator.
                'relative flex w-full cursor-pointer rounded-lg text-sm h-auto',
                isCollapsed
                  ? 'justify-center px-0 py-2'
                  : 'justify-start gap-3 px-3 py-2.5',
                isActive
                  ? cn(railActive, 'font-bold')
                  : cn(railText, railHover, 'font-medium'),
              )}
            >
              {/* Brand-500 vertical indicator beside the active item (mockup
                  `.sb-ind`). Sits on the inline-start edge (right in RTL),
                  rounded, ~9px tall. Token-driven via the accent var. Only the
                  active item renders it; hidden on the collapsed icon-rail
                  where the accent wash already signals selection. */}
              {isActive && !isCollapsed && (
                <span
                  aria-hidden
                  data-testid="sidebar-active-indicator"
                  className="absolute start-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-[var(--accent)]"
                />
              )}
              <span className="shrink-0">{item.icon}</span>
              {/* min-w-0 + truncate: the longest label ("טבלאות אופטימיזציה")
                  fits the expanded rail today, but this gracefully ellipsizes
                  instead of clipping/pushing layout if the rail narrows or a
                  future label is longer; the full text stays in the DOM for
                  screen readers, and the collapsed state still gets RailTooltip. */}
              {!isCollapsed && <span className="truncate min-w-0">{item.label}</span>}
            </Button>
          );
          return (
            <RailTooltip
              key={item.key}
              show={showTooltips}
              label={item.label}
              shortcut={`⌘${item.slot}`}
            >
              {button}
            </RailTooltip>
          );
        })}
      </nav>

      {/* Footer: operator + theme toggle + pin */}
      <div className="border-t border-[color-mix(in_oklab,var(--sidebar-fg)_12%,transparent)] px-2 py-3 space-y-1">
        <RailTooltip show={showTooltips} label="ניהול">
          <Link
            href="/operator"
            onClick={() => onItemClick?.()}
            aria-label={isCollapsed ? 'ניהול' : undefined}
            className={cn(
              'flex w-full cursor-pointer items-center rounded-lg text-sm',
              isCollapsed
                ? 'justify-center px-0 py-2'
                : 'justify-start gap-3 px-3 py-2.5',
              railText, railHover,
            )}
          >
            <Cog size={16} />
            {!isCollapsed && <span>ניהול</span>}
          </Link>
        </RailTooltip>

        <div className={cn('flex items-center gap-1 px-1', isCollapsed && 'flex-col')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="עקוב אחר ההעדפה של המערכת"
            onClick={() => setChoice('system')}
            className={cn(
              railText, railHover,
              choice === 'system' && railActive,
            )}
          >
            <Monitor size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="מצב בהיר"
            onClick={() => setChoice('light')}
            className={cn(
              railText, railHover,
              choice === 'light' && railActive,
            )}
          >
            <Sun size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="מצב כהה"
            onClick={() => setChoice('dark')}
            className={cn(
              railText, railHover,
              choice === 'dark' && railActive,
            )}
          >
            <Moon size={14} />
          </Button>
        </div>

        {/* Logout — POSTs to /api/logout then hard-navigates to "/". Self-
            contained ghost primitive (own LogOut icon + Hebrew label); sits
            with the other account/session controls in the footer. Inherits the
            rail's collapse state + sidebar-fg tokens so it renders icon-only on
            the 72px rail and reads correctly on the rail surface in both themes
            — matching the operator Link / theme-toggle / pin siblings above. */}
        <RailTooltip show={showTooltips} label="התנתק">
          <LogoutButton collapsed={isCollapsed} railText={railText} railHover={railHover} />
        </RailTooltip>

        {variant === 'desktop' && (
          <RailTooltip
            show={showTooltips}
            label={pinned ? 'בטל הצמדה' : 'הצמד פתוח'}
            shortcut="⌘\"
          >
            <Button
              type="button"
              variant="ghost"
              aria-label={pinned ? 'בטל הצמדה' : 'הצמד פתוח'}
              aria-pressed={pinned}
              onClick={onTogglePin}
              data-testid="sidebar-pin-toggle"
              className={cn(
                'w-full h-auto p-1.5 cursor-pointer',
                pinned ? railActive : cn(railText, railHover),
              )}
            >
              {/* Pin glyph rotates from "ready to pin" → "pinned" so the
                  affordance reads at a glance even before the user finds
                  the tooltip. PinOff = currently pinned, click to release;
                  Pin = currently free, click to pin open. */}
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </Button>
          </RailTooltip>
        )}
      </div>
    </>
  );
}

/**
 * Desktop sidebar interaction model (Task 5.8 — Q10):
 *
 *   - Default state: 72px icon-rail (collapsed).
 *   - Hover anywhere over the rail for 200ms → temporarily expand to
 *     220px. Mouse leave collapses it back unless pinned.
 *   - Pin button in the footer flips the sticky `sidebar:pinned`
 *     preference (persisted via useSidebarPin → localStorage).
 *   - ⌘\ (Cmd+\ on macOS, Ctrl+\ on Windows/Linux) toggles the pinned
 *     state globally. Same convention as VS Code / Cursor. (FocusMode's
 *     chrome-dim shortcut moved OFF this chord to ⌘. in reskin-w2 — the two
 *     used to collide on ⌘\; the pin is the more discoverable affordance so
 *     it keeps the chord.)
 *
 * Width math: `expanded = pinned || hoverExpanded`. Width transitions at
 * 200ms ease-out via Tailwind's transition-[width] utility — Tailwind's
 * `duration-200` is exactly the 200ms cited by the mockup. The
 * `ease-out` keyword matches `transition: width 200ms ease-out` from the
 * mockup CSS verbatim.
 */
export function Sidebar({
  activeTab,
  onTabChange,
  isMobileOpen,
  onMobileClose,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
  /** Mobile (< md) drawer state. Ignored on desktop. */
  isMobileOpen: boolean;
  /** Called when the user closes the mobile drawer (backdrop tap, nav click). */
  onMobileClose: () => void;
}) {
  const { pinned, togglePin } = useSidebarPin();
  const [hoverExpanded, setHoverExpanded] = useState(false);
  // Use the cross-platform Timeout type (browser + Node both narrow to
  // number/Timeout via the DOM lib; `ReturnType<typeof setTimeout>` is the
  // portable form). Stored in a ref so we can cancel on a fast mouse-out
  // without re-rendering.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = pinned || hoverExpanded;

  const onMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverExpanded(true);
      hoverTimerRef.current = null;
    }, 200);
  }, []);

  const onMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverExpanded(false);
  }, []);

  // Cancel any pending hover-expand timer on unmount so we never call
  // setState on an unmounted component during fast nav.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Global ⌘\ (Cmd+\) / Ctrl+\ shortcut to toggle the pin state. Mirrors
  // the keyboard model used by CommandPalette for Cmd+K — listen on
  // document, gate to non-editable targets, preventDefault to avoid the
  // browser's default behaviour (Chrome / Firefox have no built-in
  // binding for \, but Safari / extension shortcuts sometimes do).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        const t = e.target as HTMLElement | null;
        const isEditable =
          !!t && (
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
          );
        if (isEditable) return;
        e.preventDefault();
        togglePin();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePin]);

  // Mobile drawer Esc handling — routed through the shared drawer-stack so Esc
  // addresses only the TOPMOST open drawer (a CampaignDrawer/Modal opened over
  // the nav won't be collapsed by the same keystroke). The Radix Sheet's own
  // Esc-dismiss is suppressed below (onEscapeKeyDown preventDefault) and we
  // delegate closing to this stack, matching the campaign-drawer / store-modal
  // convention. Scroll-lock + focus-trap now come from Radix for free (the
  // hand-rolled fixed-overlay div + manual documentElement overflow toggle are
  // GONE — reskin-w2 "modal/drawer must be Radix" fix).
  useDrawerEsc(isMobileOpen, onMobileClose);

  return (
    <>
      {/* ===== Desktop right-rail (md and up) ===== */}
      <aside
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-testid="desktop-sidebar"
        data-expanded={expanded ? 'true' : 'false'}
        data-pinned={pinned ? 'true' : 'false'}
        style={{ width: expanded ? 220 : 72 }}
        className={cn(
          // Horizon rail — SOLID surface in BOTH themes via the --sidebar token
          // (white in light, navy-800 in dark). The shadow-sheet drop gives the
          // rail the mockup's floating-panel lift without a hard border seam.
          'sticky top-0 h-screen border-s border-glass-edge bg-[var(--sidebar)] text-[var(--sidebar-fg)] shadow-sheet',
          'hidden md:flex flex-col transition-[width] duration-200 ease-out',
        )}
        aria-label="ניווט ראשי"
      >
        <SidebarBody
          activeTab={activeTab}
          onTabChange={onTabChange}
          collapsed={!expanded}
          pinned={pinned}
          onTogglePin={togglePin}
          variant="desktop"
        />
      </aside>

      {/* ===== Mobile off-canvas drawer (< md) =====
          Now a Radix Sheet (variant="drawer", side="end") — opens from the
          inline-end edge (LEFT in RTL Hebrew). Radix gives us a focus trap,
          scroll-lock, a tokenised overlay scrim, and aria-modal/role=dialog
          for free — replacing the previous hand-rolled fixed-overlay div +
          manual documentElement.overflow toggle (which violated the project's
          "modal/drawer must be Radix" convention — the 2026-06-03
          ProductPickerModal incident). Esc is delegated to the shared
          drawer-stack (see useDrawerEsc above); Radix's built-in Esc dismiss
          is suppressed so nested drawers don't all collapse on one keystroke.

          `md:hidden` keeps the drawer wrapper off the desktop breakpoint, but
          since it only renders content when `isMobileOpen`, the desktop path is
          unaffected regardless. */}
      <Sheet open={isMobileOpen} onOpenChange={(o) => !o && onMobileClose()}>
        <SheetContent
          variant="drawer"
          side="end"
          dir="rtl"
          className={cn(
            // Solid rail surface (NOT the drawer-variant glass gradient) so the
            // mobile body is fully opaque on phones — operator feedback said the
            // glass treatment let underlying content bleed through and made the
            // labels hard to read. Override the gradient with the --sidebar
            // token + drop the blur. w-64/max-w to match the prior off-canvas.
            'md:hidden flex flex-col p-0 w-64 max-w-[80vw]',
            'bg-[var(--sidebar)] [background-image:none] text-[var(--sidebar-fg)]',
            '[backdrop-filter:none] [-webkit-backdrop-filter:none]',
          )}
          // No aria-label here: the sr-only <SheetTitle> below names the dialog
          // via Radix's aria-labelledby, which takes ARIA precedence over
          // aria-label — so an aria-label would be dead. Single source of name.
          // The drawer has no descriptive body copy; opt out of Radix's
          // optional Description requirement so it doesn't dev-warn.
          aria-describedby={undefined}
          data-testid="mobile-drawer"
          // Delegate Esc to the drawer-stack (see useDrawerEsc above) instead
          // of Radix's own dismiss, so a drawer opened OVER this nav addresses
          // its own Esc first.
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* Radix requires an accessible name; the brand wordmark is decorative
              markup, so provide a visually-hidden Title (silences Radix's dev
              warning + names the dialog for AT). */}
          <SheetTitle className="sr-only">ניווט ראשי</SheetTitle>
          <SidebarBody
            activeTab={activeTab}
            onTabChange={onTabChange}
            collapsed={false}
            pinned={false}
            onTogglePin={() => undefined}
            onItemClick={onMobileClose}
            variant="mobile"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
