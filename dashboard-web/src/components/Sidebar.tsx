'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Home, Receipt, TrendingUp, Megaphone, Package, Table,
  Cog, Sun, Moon, Monitor, PanelRightOpen, PanelRightClose, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/Button';
import type { TabKey } from '@/lib/urlState';

type NavItem = { key: TabKey; label: string; icon: React.ReactNode };

const NAV: NavItem[] = [
  { key: 'home',      label: 'בית',     icon: <Home size={16} /> },
  { key: 'pnl',       label: 'P&L',     icon: <Receipt size={16} /> },
  { key: 'analysis',  label: 'ניתוח',    icon: <TrendingUp size={16} /> },
  { key: 'campaigns', label: 'קמפיינים', icon: <Megaphone size={16} /> },
  { key: 'products',  label: 'מוצרים',   icon: <Package size={16} /> },
  { key: 'detail',    label: 'פירוט',    icon: <Table size={16} /> },
];

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
  onToggleCollapsed,
  onItemClick,
  onClose,
  variant,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Called after a nav item or operator link is tapped (used by mobile to close drawer). */
  onItemClick?: () => void;
  /** Mobile-only: explicit close-X handler. Renders the X button when set. */
  onClose?: () => void;
  /** 'desktop' = honours collapsed; 'mobile' = always expanded, no collapse toggle. */
  variant: 'desktop' | 'mobile';
}) {
  const { choice, setChoice } = useTheme();
  const isCollapsed = variant === 'desktop' && collapsed;

  return (
    <>
      {/* Brand + (mobile) close button */}
      <div className="px-3 py-3 border-b border-glass-edge flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-accent shrink-0" aria-hidden />
        {!isCollapsed && (
          <span className="text-sm font-semibold truncate flex-1">דשבורד ROAS</span>
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
          return (
            <Button
              key={item.key}
              role="tab"
              type="button"
              variant="ghost"
              aria-current={isActive ? 'page' : undefined}
              aria-selected={isActive}
              onClick={() => {
                onTabChange(item.key);
                onItemClick?.();
              }}
              className={cn(
                'flex w-full justify-start gap-3 rounded-md px-2.5 py-2 text-sm h-auto',
                isActive
                  ? 'bg-glass-2 text-ink font-medium ring-1 ring-glass-edge'
                  : 'text-ink-muted hover:text-ink hover:bg-glass-1',
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
            </Button>
          );
        })}
      </nav>

      {/* Footer: operator + theme toggle + collapse */}
      <div className="border-t border-glass-edge px-2 py-3 space-y-1">
        <Link
          href="/operator"
          onClick={() => onItemClick?.()}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm',
            'text-ink-muted hover:text-ink hover:bg-glass-2',
          )}
        >
          <Cog size={16} />
          {!isCollapsed && <span>ניהול</span>}
        </Link>

        <div className={cn('flex items-center gap-1 px-1', isCollapsed && 'flex-col')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="עקוב אחר ההעדפה של המערכת"
            onClick={() => setChoice('system')}
            className={cn(
              'text-ink-muted',
              choice === 'system' && 'bg-glass-2 text-ink',
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
              'text-ink-muted',
              choice === 'light' && 'bg-glass-2 text-ink',
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
              'text-ink-muted',
              choice === 'dark' && 'bg-glass-2 text-ink',
            )}
          >
            <Moon size={14} />
          </Button>
        </div>

        {variant === 'desktop' && (
          <Button
            type="button"
            variant="ghost"
            aria-label={collapsed ? 'הרחב' : 'כווץ'}
            onClick={onToggleCollapsed}
            className="w-full h-auto p-1.5 text-ink-muted"
          >
            {/* RTL note (Task 4.8): the sidebar lives on the RTL-start
                edge (right in Hebrew). PanelRightOpen / PanelRightClose
                are *logical* glyphs — they visually depict a right-edge
                panel revealing or tucking away its content, which matches
                this sidebar's geometry regardless of writing direction.
                The prior ChevronsLeft/ChevronsRight pointed the wrong way
                in RTL because they're purely physical-direction icons. */}
            {collapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </Button>
        )}
      </div>
    </>
  );
}

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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* ===== Desktop right-rail (md and up) — unchanged behaviour ===== */}
      <aside
        className={cn(
          'sticky top-0 h-screen border-s border-glass-edge bg-glass-1 text-ink',
          'hidden md:flex flex-col transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
        aria-label="ניווט ראשי"
      >
        <SidebarBody
          activeTab={activeTab}
          onTabChange={onTabChange}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(v => !v)}
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
      <div
        onClick={onMobileClose}
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-0 bg-glass-3/60 z-40 md:hidden transition-opacity duration-DEFAULT',
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
          'bg-glass-1 text-ink shadow-sheet overflow-y-auto',
          'flex flex-col transition-transform duration-DEFAULT',
          isMobileOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <SidebarBody
          activeTab={activeTab}
          onTabChange={onTabChange}
          collapsed={false}
          onToggleCollapsed={() => undefined}
          onItemClick={onMobileClose}
          onClose={onMobileClose}
          variant="mobile"
        />
      </aside>
    </>
  );
}
