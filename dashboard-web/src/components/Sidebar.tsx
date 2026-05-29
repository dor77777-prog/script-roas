'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Home, Receipt, TrendingUp, Megaphone, Package, Table,
  Cog, Sun, Moon, Monitor, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
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
  variant,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Called after a nav item or operator link is tapped (used by mobile to close drawer). */
  onItemClick?: () => void;
  /** 'desktop' = honours collapsed; 'mobile' = always expanded, no collapse toggle. */
  variant: 'desktop' | 'mobile';
}) {
  const { choice, setChoice } = useTheme();
  const isCollapsed = variant === 'desktop' && collapsed;

  return (
    <>
      {/* Brand */}
      <div className="px-3 py-4 border-b border-line-subtle flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-accent" aria-hidden />
        {!isCollapsed && (
          <span className="text-sm font-semibold truncate">דשבורד ROAS</span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" role="tablist">
        {NAV.map(item => {
          const isActive = item.key === activeTab;
          return (
            <button
              key={item.key}
              role="tab"
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-selected={isActive}
              onClick={() => {
                onTabChange(item.key);
                onItemClick?.();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'bg-elevated2 text-ink font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-elevated2',
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer: operator + theme toggle + collapse */}
      <div className="border-t border-line-subtle px-2 py-3 space-y-1">
        <Link
          href="/operator"
          onClick={() => onItemClick?.()}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm',
            'text-ink-muted hover:text-ink hover:bg-elevated2',
          )}
        >
          <Cog size={16} />
          {!isCollapsed && <span>ניהול</span>}
        </Link>

        <div className={cn('flex items-center gap-1 px-1', isCollapsed && 'flex-col')}>
          <button
            type="button"
            aria-label="עקוב אחר ההעדפה של המערכת"
            onClick={() => setChoice('system')}
            className={cn(
              'rounded-md p-2.5 text-ink-muted hover:bg-elevated2',
              choice === 'system' && 'bg-elevated2 text-ink',
            )}
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            aria-label="מצב בהיר"
            onClick={() => setChoice('light')}
            className={cn(
              'rounded-md p-2.5 text-ink-muted hover:bg-elevated2',
              choice === 'light' && 'bg-elevated2 text-ink',
            )}
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            aria-label="מצב כהה"
            onClick={() => setChoice('dark')}
            className={cn(
              'rounded-md p-2.5 text-ink-muted hover:bg-elevated2',
              choice === 'dark' && 'bg-elevated2 text-ink',
            )}
          >
            <Moon size={14} />
          </button>
        </div>

        {variant === 'desktop' && (
          <button
            type="button"
            aria-label={collapsed ? 'הרחב' : 'כווץ'}
            onClick={onToggleCollapsed}
            className="flex w-full items-center justify-center rounded-md p-1.5 text-ink-muted hover:bg-elevated2"
          >
            {collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
          </button>
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
          'sticky top-0 h-screen border-s border-line bg-elevated text-ink',
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
          drawer panel slides in from the end (right in RTL). Both layers
          remain mounted so the slide-out animation has something to
          animate against; pointer-events disable interaction on backdrop
          while closed so the page underneath stays interactive. */}
      <div
        onClick={onMobileClose}
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-0 bg-overlay/60 z-40 md:hidden transition-opacity duration-DEFAULT',
          isMobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ניווט ראשי"
        aria-hidden={!isMobileOpen}
        className={cn(
          'fixed inset-y-0 end-0 w-72 max-w-[85vw] z-50 md:hidden',
          'bg-elevated text-ink shadow-elevated overflow-y-auto',
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
          variant="mobile"
        />
      </aside>
    </>
  );
}
