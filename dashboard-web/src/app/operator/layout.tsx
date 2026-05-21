// dashboard-web/src/app/operator/layout.tsx
//
// RTL wrapper for the /operator route ("ניהול" — Management).
//
// The root `app/layout.tsx` already sets `<html lang="he" dir="rtl">`, so this
// layout is mostly a scoping seam: it lets plans 13-16 add operator-specific
// chrome (top bar, breadcrumbs, jobs-status pill) without touching the global
// shell. We still pass `dir="rtl"` on this inner wrapper so the page renders
// correctly when previewed in isolation (e.g., Next.js dev RSC preview that
// renders the segment outside of `RootLayout`).
//
// Visual style matches the existing dashboard per D-D4: same `bg-background`
// + `text-foreground` tokens, no new design primitives.
//
// Phase 05.6 plan 12 — operator console UI shell.

import type { ReactNode } from 'react';

export const metadata = {
  title: 'ניהול — ROAS Dashboard',
};

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-text-primary">
      {children}
    </div>
  );
}
