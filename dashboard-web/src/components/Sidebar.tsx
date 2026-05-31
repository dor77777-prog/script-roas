'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Home, Receipt, TrendingUp, Megaphone, Package, Table,
  Cog, Sun, Moon, Monitor, Pin, PinOff, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { useSidebarPin } from '@/lib/hooks/useSidebarPin';
import type { TabKey } from '@/lib/urlState';

type NavItem = {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  /** 1-based slot used in the ⌘N tooltip hint on collapsed state. */
  slot: number;
};

const NAV: NavItem[] = [
  { key: 'home',      label: 'בית',      icon: <Home size={16} />,        slot: 1 },
  { key: 'pnl',       label: 'P&L',      icon: <Receipt size={16} />,     slot: 2 },
  { key: 'analysis',  label: 'ניתוח',    icon: <TrendingUp size={16} />,  slot: 3 },
  { key: 'campaigns', label: 'קמפיינים', icon: <Megaphone size={16} />,   slot: 4 },
  { key: 'products',  label: 'מוצרים',   icon: <Package size={16} />,     slot: 5 },
  { key: 'detail',    label: 'פירוט',    icon: <Table size={16} />,       slot: 6 },
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
    <HelpTooltip content={content} side="left" sideOffset={10}>
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
  onClose,
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
  /** Mobile-only: explicit close-X handler. Renders the X button when set. */
  onClose?: () => void;
  /** 'desktop' = honours collapsed; 'mobile' = always expanded, no collapse toggle. */
  variant: 'desktop' | 'mobile';
}) {
  const { choice, setChoice } = useTheme();
  const isCollapsed = variant === 'desktop' && collapsed;
  const showTooltips = isCollapsed;
  // Desktop rail is a DARK surface in BOTH themes (sidebar tokens), so its
  // inner items render light-on-dark via the sidebar fg tokens + faint
  // white-alpha hovers. The mobile drawer sits on bg-canvas, so it keeps the
  // normal ink/glass classes that read correctly on the themed canvas.
  const isDesktop = variant === 'desktop';
  // Default (resting) text colour for an inner item.
  const railText = isDesktop ? 'text-[var(--sidebar-fg)]' : 'text-ink-muted';
  // Hover treatment — brighten text + faint white-alpha fill on dark rail.
  const railHover = isDesktop
    ? 'hover:text-[var(--sidebar-fg-active)] hover:bg-white/[0.06]'
    : 'hover:text-ink hover:bg-glass-2';
  // Active / selected treatment — violet tint + active fg on dark rail.
  const railActive = isDesktop
    ? 'bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-[var(--sidebar-fg-active)]'
    : 'bg-glass-2 text-ink';

  return (
    <>
      {/* Brand + (mobile) close button */}
      <div
        className={cn(
          'px-3 py-3 border-b flex items-center gap-2',
          isDesktop ? 'border-white/10' : 'border-glass-edge',
        )}
      >
        {/* Logo keeps the violet gradient in both themes (mockup .sb-logo). */}
        <div
          className="h-7 w-7 rounded-md shrink-0 bg-gradient-to-br from-[var(--sidebar-logo-1)] to-[var(--sidebar-logo-2)]"
          aria-hidden
        />
        {!isCollapsed && (
          <span
            className={cn(
              'text-sm font-semibold truncate flex-1',
              isDesktop && 'text-[var(--sidebar-fg-active)]',
            )}
          >
            דשבורד ROAS
          </span>
        )}
        {variant === 'mobile' && onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="סגור תפריט"
            className="-me-1 shrink-0"
          >
            <X size={20} />
          </Button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" role="tablist">
        {NAV.map(item => {
          const isActive = item.key === activeTab;
          const button = (
            <Button
              key={item.key}
              role="tab"
              type="button"
              variant="ghost"
              aria-current={isActive ? 'page' : undefined}
              aria-selected={isActive}
              aria-label={isCollapsed ? item.label : undefined}
              onClick={() => {
                onTabChange(item.key);
                onItemClick?.();
              }}
              className={cn(
                'flex w-full rounded-md text-sm h-auto',
                isCollapsed
                  ? 'justify-center px-0 py-2'
                  : 'justify-start gap-3 px-2.5 py-2',
                isActive
                  ? cn(railActive, 'font-medium ring-1 ring-glass-edge')
                  : cn(railText, railHover),
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
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
      <div
        className={cn(
          'border-t px-2 py-3 space-y-1',
          isDesktop ? 'border-white/10' : 'border-glass-edge',
        )}
      >
        <RailTooltip show={showTooltips} label="ניהול">
          <Link
            href="/operator"
            onClick={() => onItemClick?.()}
            aria-label={isCollapsed ? 'ניהול' : undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm',
              isCollapsed
                ? 'justify-center px-0 py-2'
                : 'justify-start gap-3 px-2.5 py-2',
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
                'w-full h-auto p-1.5',
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
 *     state globally. Same convention as VS Code / Cursor.
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

  // Body scroll-lock while the mobile drawer is open. The Sidebar drawer is
  // hand-rolled (not Radix Dialog), so we don't get Radix's automatic
  // scroll-lock for free. Without this, tapping the drawer while the
  // dashboard underneath has scrollable content would let the user scroll
  // BOTH layers — the page would slide behind the open menu. We toggle
  // `overflow-hidden` on documentElement (mirrors what Radix does) so it
  // also works on iOS Safari where body-level overflow can be ignored.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isMobileOpen) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prev;
    };
  }, [isMobileOpen]);

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
          // Mockup keeps a DARK slim rail in BOTH themes — use the sidebar
          // tokens (theme-independent #15182a) rather than bg-glass-1/text-ink
          // so the rail never goes dark-on-dark or washes out on light.
          'sticky top-0 h-screen border-s border-glass-edge bg-[var(--sidebar)] text-[var(--sidebar-fg)]',
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
          Backdrop dims the page and closes the drawer when tapped. The
          drawer panel slides in from the START side — RIGHT in RTL Hebrew
          (matches where the hamburger button sits in the header strip;
          taps reveal the menu from the same edge). Both layers remain
          mounted so the slide-out animation has something to animate
          against; pointer-events disable interaction on backdrop while
          closed so the page underneath stays interactive.

          Slide math: drawer is anchored at `start-0` (right edge in RTL).
          Tailwind's `translate-x-full` is always `translateX(+100%)` which
          is rightward — when the drawer is at the right edge, moving it
          +100% pushes it OFF-screen to the right. So `translate-x-full`
          = closed (off-screen right), `translate-x-0` = open (right edge).
          In LTR (English) this would be off-screen left instead — fine,
          but we're RTL-first here. */}
      {/* Backdrop — solid canvas tint at 70% so the content behind reads as
          a clearly dimmed layer (not a slightly-tinted bleed-through). The
          mobile sidebar Sheet is hand-rolled so we don't get Radix's
          stronger-by-default overlay; bumping to the canvas tone matches
          the visual weight of native iOS / Android navigation drawers. */}
      <div
        onClick={onMobileClose}
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-0 bg-canvas-2/70 backdrop-blur-sm z-40 md:hidden transition-opacity duration-DEFAULT',
          isMobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ניווט ראשי"
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-y-0 start-0 w-64 max-w-[80vw] z-50 md:hidden',
          // Solid canvas background (NOT glass-1's 4% alpha) so the drawer
          // body is fully opaque on phones — operator feedback said the
          // glass treatment let underlying content bleed through and made
          // the labels hard to read. Desktop rail keeps the glass look.
          'bg-canvas text-ink shadow-sheet overflow-y-auto',
          'border-s border-glass-edge',
          'flex flex-col transition-transform duration-DEFAULT',
          isMobileOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <SidebarBody
          activeTab={activeTab}
          onTabChange={onTabChange}
          collapsed={false}
          pinned={false}
          onTogglePin={() => undefined}
          onItemClick={onMobileClose}
          onClose={onMobileClose}
          variant="mobile"
        />
      </aside>
    </>
  );
}
