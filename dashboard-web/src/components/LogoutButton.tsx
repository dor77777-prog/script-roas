'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * Logout button (2026-06-02). POSTs to /api/logout (clears the session
 * cookie server-side) then hard-navigates to "/" so the now-unauthenticated
 * shell re-renders the gate. Single-user, URL-obscurity trust model.
 *
 * Rendered as a footer control inside the shared Sidebar shell, so it mirrors
 * the sibling footer controls (operator Link, theme toggles, pin):
 *   - `collapsed` gates the Hebrew label so the 72px desktop icon-rail stays
 *     icon-only and centered — the wrapping RailTooltip surfaces the label.
 *   - `railText`/`railHover` come from SidebarBody so the text colour suits
 *     the DARK rail surface in BOTH themes (never the canvas ink palette,
 *     which would go dark-on-dark in light mode). Defaults keep it usable on
 *     a normal canvas surface if mounted standalone.
 */
export function LogoutButton({
  collapsed = false,
  railText = 'text-ink-secondary',
  railHover = 'hover:text-ink',
}: {
  /** True when the host rail is the 72px collapsed icon-rail (desktop). */
  collapsed?: boolean;
  /** Resting text colour token for the host surface (sidebar-fg on the rail). */
  railText?: string;
  /** Hover treatment token for the host surface. */
  railHover?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={busy}
      aria-label={collapsed ? 'התנתק' : undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/logout', { method: 'POST' });
          window.location.assign('/');
        } catch {
          setBusy(false);
        }
      }}
      className={cn(
        'flex w-full items-center rounded-md text-sm h-auto',
        collapsed ? 'justify-center px-0 py-2' : 'justify-start gap-3 px-2.5 py-2',
        railText,
        railHover,
      )}
    >
      <LogOut size={16} aria-hidden />
      {!collapsed && <span>התנתק</span>}
    </Button>
  );
}
