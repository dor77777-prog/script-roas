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

export function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { choice, setChoice } = useTheme();

  return (
    <aside
      className={cn(
        'sticky top-0 h-screen border-s border-line bg-elevated text-ink',
        'flex flex-col transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
      aria-label="ניווט ראשי"
    >
      {/* Brand */}
      <div className="px-3 py-4 border-b border-line-subtle flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-accent" aria-hidden />
        {!collapsed && (
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
              onClick={() => onTabChange(item.key)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'bg-elevated2 text-ink font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-elevated2',
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer: operator + theme toggle + collapse */}
      <div className="border-t border-line-subtle px-2 py-3 space-y-1">
        <Link
          href="/operator"
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm',
            'text-ink-muted hover:text-ink hover:bg-elevated2',
          )}
        >
          <Cog size={16} />
          {!collapsed && <span>ניהול</span>}
        </Link>

        <div className={cn('flex items-center gap-1 px-1', collapsed && 'flex-col')}>
          <button
            type="button"
            aria-label="עקוב אחר ההעדפה של המערכת"
            onClick={() => setChoice('system')}
            className={cn(
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
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
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
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
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
              choice === 'dark' && 'bg-elevated2 text-ink',
            )}
          >
            <Moon size={14} />
          </button>
        </div>

        <button
          type="button"
          aria-label={collapsed ? 'הרחב' : 'כווץ'}
          onClick={() => setCollapsed(v => !v)}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-ink-muted hover:bg-elevated2"
        >
          {collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
        </button>
      </div>
    </aside>
  );
}
